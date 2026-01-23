VENV = .venv
PYTHON = $(VENV)/bin/python

.PHONY: all build install clean help dist deepclean

all: build

help:
	@echo "Gallery Build System Commands:"
	@echo "  make install  - Create virtual environment and install dependencies"
	@echo "  make build    - Build the site using the local environment"
	@echo "  make clean     - Remove build artifacts (thumbs, metadata, _site)"
	@echo "  make deepclean - Remove artifacts and the virtual environment"
	@echo "  make dist      - Prepare the _site directory for deployment"
	@echo "  make help      - Show this help message"

DIST_DIR = _site

build: $(VENV)
	$(PYTHON) prepareSite.py -n 25 -q 85

dist: build
	rm -rf $(DIST_DIR)
	mkdir -p $(DIST_DIR)
	cp index.html immersive.html license.html LICENSE $(DIST_DIR)/
	cp -r css js fulls metadata thumbs $(DIST_DIR)/

install: $(VENV)

$(VENV): requirements.txt
	python -m pip install --upgrade pip
	python -m venv $(VENV)
	$(VENV)/bin/pip install -r requirements.txt
	touch $(VENV)

clean:
	rm -rf thumbs metadata $(DIST_DIR)

deepclean: clean
	rm -rf $(VENV)
