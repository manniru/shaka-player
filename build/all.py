#!/usr/bin/python
#
# Copyright 2016 Google Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import check
import build
import gendeps
import shakaBuildHelpers

def main(_):
  code = gendeps.genDeps([])
  if code != 0:
    return code

  code = check.main([])
  if code != 0:
    return code

  return build.main(['--name', 'compiled', '+@complete'])

if __name__ == '__main__':
  shakaBuildHelpers.runMain(main)